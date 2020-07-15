import * as fs from 'fs'
import path from 'path'
import logger from 'loglevel'
import sort from 'fast-sort'
import * as mm from 'music-metadata'
import convert from 'xml-js'

const atob = data => Buffer.from(data, 'base64').toString()

function getPodcastMiddleware({
  title: podcastTitle,
  image: podcastImage,
  description: podcastDescription,
  modifyXmlJs = xmlJs => xmlJs,
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
              for (const nativeMetadata of Object.values(metadata.native)) {
                const foundItem = nativeMetadata.find(
                  item => item.id.toLowerCase() === nativeId.toLowerCase(),
                )
                if (foundItem) {
                  if (foundItem.value.text) {
                    return foundItem.value.text
                  } else {
                    return foundItem.value
                  }
                }
              }
              // the value probably doesn't exist...
              return ''
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
              summary: description = getNativeValue('TXXX:comment') ||
                getNativeValue('COMM:comment'),
              asin: id = metadata.common.asin,
              author = metadata.common.artist,
              copyright = metadata.common.copyright,
              duration = metadata.format.duration,
              narrated_by: narrators = getNativeValue('TXXX:narrated_by'),
              genre: category = getNativeValue('TXXX:book_genre') ||
                getNativeValue('TXXX:genre'),
              release_date: date = getNativeValue('TXXX:year'),
            } = audibleMetadata

            const {
              picture: [picture = getNativeValue('APIC')] = [],
            } = metadata.common

            return {
              id,
              title,
              author,
              pubDate: new Date(date),

              description,
              content: description,
              category: category?.split?.(':').map(c => c.trim()),

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

    cache = {}
    for (const item of items) {
      if (item) {
        cache[item.id] = item
      }
    }
  }

  async function feed(req, res) {
    let items = Object.values(await getFilesMetadata())

    // filter in/out
    const filterInOptions = (req.query.filterIn ?? '')
      .split(',')
      .filter(Boolean)
      .map(set => {
        const [regexString, prop] = set.split(':')
        return {regex: new RegExp(regexString, 'im'), prop}
      })
    const filterOutOptions = (req.query.filterOut ?? '')
      .split(',')
      .filter(Boolean)
      .map(set => {
        const [regexString, prop] = set.split(':')
        return {regex: new RegExp(regexString, 'im'), prop}
      })
    items = items.filter(item => {
      for (const {regex, prop} of filterInOptions) {
        if (!item.hasOwnProperty(prop)) return false
        if (!regex.test(item[prop])) return false
      }
      for (const {regex, prop} of filterOutOptions) {
        if (!item.hasOwnProperty(prop)) break
        if (regex.test(item[prop])) return false
      }
      return true
    })

    // sort
    const sortOptions = (req.query.sort ?? 'desc:pubDate')
      .split(',')
      .map(set => {
        const [dir, prop] = set.split(':')
        return {[dir]: i => i[prop]}
      })
    items = sort([...items]).by(sortOptions)

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
          title: req.query.title || podcastTitle,
          link: getResourceUrl(),
          description: {
            _cdata: req._parsedUrl.query
              ? `<p>${podcastDescription}</p>\n\n<p>query: ${req._parsedUrl.query}</p>`
              : podcastDescription,
          },
          lastBuildDate: new Date().toUTCString(),
          image: removeEmpty(
            req.query['image.url']
              ? {
                  link: req.query['image.link'],
                  title: req.query['image.title'],
                  description: req.query['image.description'],
                  height: req.query['image.height'],
                  width: req.query['image.width'],
                  url: req.query['image.url'],
                }
              : podcastImage,
          ),
          generator: getResourceUrl(),
        },
        item: items.map(item => {
          const {
            id,
            title,
            description,
            pubDate,
            category,
            author,
            duration,
            size,
            type,
          } = item

          return removeEmpty({
            guid: {_attributes: {isPermaLink: false}, _text: id},
            title,
            description: {_cdata: description},
            pubDate: pubDate.toUTCString(),
            author,
            category,
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
          })
        }),
      },
    }

    res.set('Content-Type', 'text/xml')
    const finalObj = modifyXmlJs(xmlObj)
    res.send(
      convert.js2xml(finalObj, {
        compact: true,
        ignoreComment: true,
        spaces: 2,
      }),
    )

    function getResourceUrl(id = '') {
      const baseUrl = new URL(
        [
          req.secure ? 'https' : 'http',
          '://',
          req.get('host'),
          req.baseUrl,
        ].join(''),
      )

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

  async function bustCache(req, res) {
    await loadFileMetadataCache()
    res.send('success 🎉')
  }

  return {feed, image, audio, bustCache}
}

function removeEmpty(obj) {
  if (!obj) {
    return obj
  }
  const newObj = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value != null) {
      newObj[key] = value
    }
  }
  return newObj
}

export {getPodcastMiddleware}

/*
eslint
  max-lines-per-function: "off",
  no-inner-declarations: "off",
  consistent-return: "off",
  "babel/camelcase": "off",
*/
