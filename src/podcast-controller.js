import * as fs from 'fs'
import path from 'path'
import logger from 'loglevel'
import * as mm from 'music-metadata'
import convert from 'xml-js'

const atob = data => Buffer.from(data, 'base64').toString()

function getPodcastMiddleware({
  title: podcastTitle,
  description: podcastDescription,
  directory,
}) {
  let cache = {}
  async function getFileMetadata(id) {
    if (!cache[id]) {
      await loadFileMetadataCache()
    }
    return cache[id]
  }

  async function getFilesMetadata() {
    if (!Object.keys(cache).length) {
      await loadFileMetadataCache()
    }
    return cache
  }

  async function loadFileMetadataCache() {
    cache = {}

    const files = await fs.promises.readdir(directory)
    const items = await Promise.all(
      files
        .filter(file => file.endsWith('.mp3'))
        .map(async file => {
          try {
            const filepath = path.join(directory, file)
            const stat = await fs.promises.stat(filepath)
            let metadata
            try {
              metadata = await mm.parseFile(filepath)
            } catch (error) {
              error.stack = `This error means that we couldn't parse the metadata for ${filepath}:\n${error.stack}`
              throw error
            }

            function getNativeValue(nativeId) {
              try {
                return metadata.native['ID3v2.3'].find(
                  item => item.id === nativeId,
                ).value
              } catch (error) {
                // the value probably doesn't exist...
                return ''
              }
            }

            const json64 = getNativeValue('TXXX:json64')
            let audibleMetadata = {}
            if (json64) {
              try {
                audibleMetadata = JSON.parse(atob(json64))
              } catch {
                // sometimes the json64 data is incomplete for some reason
              }
            }
            const {
              title = metadata.common.title,
              summary: description = getNativeValue('TXXX:comment'),
              asin: id = metadata.common.asin,
              author = metadata.common.artist,
              copyright = metadata.common.copyright,
              duration = metadata.format.duration,
              narrated_by: narrators = getNativeValue('TXXX:narrated_by'),
              genre: category,
              release_date: date = getNativeValue('TXXX:year'),
            } = audibleMetadata
            const {
              picture: [picture = getNativeValue('APIC')] = [],
            } = metadata.common

            return {
              id,
              title,
              author,
              date: new Date(date),

              description,
              content: description,
              category,

              guid: id,

              size: stat.size,
              duration,
              type: `audio/${(
                metadata.format.container || 'mpeg'
              ).toLowerCase()}`,
              picture,
              contributor: narrators
                .split(',')
                .map(name => ({name: name.trim()})),

              published: new Date(date),
              copyright,
              filepath,
            }
          } catch (error) {
            logger.error(`Trouble getting metadata for "${file}"`)
            logger.error(error.stack)
            return null
          }
        }),
    )

    for (const item of items) {
      if (item) {
        cache[item.id] = item
      }
    }
  }

  async function feed(req, res) {
    const baseUrl = new URL(
      [req.secure ? 'https' : 'http', '://', req.get('host'), req.baseUrl].join(
        '',
      ),
    )

    function getResourceUrl(id = '') {
      const resourceUrl = new URL(baseUrl.toString())
      if (!resourceUrl.pathname.endsWith('/')) {
        resourceUrl.pathname = `${resourceUrl.pathname}/`
      }
      if (id.startsWith('/')) {
        id = id.slice(1)
      }
      resourceUrl.pathname = resourceUrl.pathname + id
      return resourceUrl.toString()
    }

    const items = Object.values(await getFilesMetadata()).sort((a, b) =>
      a.date.getTime() < b.date.getTime() ? 1 : -1,
    )

    const xmlObj = {
      _declaration: {_attributes: {version: '1.0', encoding: 'utf-8'}},
      rss: {
        _attributes: {
          version: '2.0',
          'xmlns:atom': 'http://www.w3.org/2005/Atom',
          'xmlns:content': 'http://purl.org/rss/1.0/modules/content/',
          'xmlns:googleplay': 'http://www.google.com/schemas/play-podcasts/1.0',
          'xmlns:itunes': 'http://www.itunes.com/dtds/podcast-1.0.dtd',
        },
        channel: {
          'atom:link': [
            {
              _attributes: {
                href: getResourceUrl('feed.xml'),
                rel: 'self',
                title: 'MP3 Audio',
                type: 'application/rss+xml',
              },
            },
            {
              _attributes: {
                rel: 'hub',
                xmlns: 'http://www.w3.org/2005/Atom',
                href: 'https://pubsubhubbub.appspot.com/',
              },
            },
          ],
          title: podcastTitle,
          link: getResourceUrl(),
          description: podcastDescription,
          lastBuildDate: new Date().toUTCString(),
          generator: getResourceUrl(),
        },
        item: items.map(item => {
          const {
            id,
            title,
            description,
            date,
            author,
            duration,
            size,
            type,
          } = item
          return {
            guid: {_attributes: {isPermaLink: false}, _text: id},
            title,
            description: {_cdata: description},
            pubDate: date.toUTCString(),
            author,
            'content:encoded': {_cdata: description},
            enclosure: {
              _attributes: {
                length: size,
                type,
                url: getResourceUrl(`${id}/audio.mp3`),
              },
            },
            'itunes:title': title,
            'itunes:author': author,
            'itunes:duration': duration,
            'itunes:image': {
              _attributes: {href: getResourceUrl(`${id}/image`)},
            },
            'itunes:summary': description,
            'itunes:subtitle': description,
            'itunes:explicit': 'no',
            'itunes:episodeType': 'full',
          }
        }),
      },
    }

    res.set('Content-Type', 'text/xml')
    res.send(
      convert.js2xml(xmlObj, {compact: true, ignoreComment: true, spaces: 2}),
    )
  }

  async function image(req, res) {
    const item = await getFileMetadata(req.params.id)
    if (!item) return res.status(404).end()

    const {
      picture: {format, data},
    } = item
    res.set('content-type', format)
    res.end(data, 'binary')
  }

  async function audio(req, res) {
    const item = await getFileMetadata(req.params.id)
    if (!item) return res.status(404).end()

    const {filepath, size} = item

    const range = req.headers.range

    let options
    if (range) {
      const positions = range.replace(/bytes=/, '').split('-')
      const start = parseInt(positions[0], 10)
      const end = positions[1] ? parseInt(positions[1], 10) : size - 1
      const chunksize = end - start + 1

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mp3',
      })

      options = {start, end}
    } else {
      res.writeHead(200, {
        'Content-Length': size,
        'Content-Type': 'audio/mp3',
      })
    }

    const stream = fs
      .createReadStream(filepath, options)
      .on('open', () => stream.pipe(res))
      .on('error', err => res.end(err))
      .on('end', () => res.end())
  }

  return {feed, image, audio}
}

export {getPodcastMiddleware}

/*
eslint
  max-lines-per-function: "off",
  no-inner-declarations: "off",
  consistent-return: "off"
*/
