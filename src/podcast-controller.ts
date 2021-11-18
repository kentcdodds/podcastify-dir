import * as fs from 'fs'
import path from 'path'
import type {Url} from 'url'
import type * as ex from 'express'
import logger from 'loglevel'
import type {ISortByObjectSorter} from 'fast-sort'
import {sort} from 'fast-sort'
import * as mm from 'music-metadata'
import type * as XMLJS from 'xml-js'
import convert from 'xml-js'
import glob from 'glob-promise'
import md5 from 'md5-hex'

const atob = (data: string) => Buffer.from(data, 'base64').toString()
function arrayify<ItemType>(val: Array<ItemType> | ItemType): Array<ItemType> {
  return Array.isArray(val) ? val : [val].filter(Boolean)
}

type Metadata = {
  id: string
  title: string
  author: string
  pubDate: Date

  description: string
  content: string
  category: Array<string>
  guid: string
  size: number
  duration?: number
  type: string
  picture?: mm.IPicture
  contributor: Array<{name: string}>

  copyright: string
  filepath: string
}

type AudibleJson64 = {
  title?: string
  summary?: string
  author?: string
  copyright?: string
  duration?: number
  narrated_by?: string
  genre?: string
  release_date?: string
}

type PodcastImage = {
  link: string
  title: string
  description: string
  height?: number
  width?: number
  url: string
}

type PodcastMiddlewareOptions = {
  title: string
  image?: PodcastImage
  description: string
  modifyXmlJs?: (xmlJs: XMLJS.ElementCompact) => XMLJS.ElementCompact
  directory: string
}

function getNativeValue(
  metadata: mm.IAudioMetadata,
  nativeId: string,
): string | undefined {
  for (const nativeMetadata of Object.values(metadata.native)) {
    const foundItem = nativeMetadata.find(
      item => item.id.toLowerCase() === nativeId.toLowerCase(),
    )
    if (foundItem) {
      if ((foundItem.value as {text: string}).text) {
        return (foundItem.value as {text: string}).text
      } else {
        return foundItem.value as string
      }
    }
  }
}

function getPodcastMiddleware({
  title: podcastTitle,
  image: podcastImage,
  description: podcastDescription,
  modifyXmlJs = xmlJs => xmlJs,
  directory,
}: PodcastMiddlewareOptions) {
  let cache: Record<string, Metadata | undefined> = {}
  async function getFileMetadata(id: string) {
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
    const files = await glob(path.join(directory, '**/*.mp3'))
    const items = await Promise.all(
      files.map(async (filepath): Promise<Metadata | null> => {
        try {
          const stat = await fs.promises.stat(filepath)
          let metadata: mm.IAudioMetadata
          try {
            metadata = await mm.parseFile(filepath)
          } catch (error: unknown) {
            if (error instanceof Error) {
              error.stack = `This error means that we couldn't parse the metadata for ${filepath}:\n${error.stack}`
            }
            throw error
          }

          const json64 = getNativeValue(metadata, 'TXXX:json64')
          let audibleMetadata: AudibleJson64 = {}
          if (json64) {
            try {
              audibleMetadata = JSON.parse(atob(json64)) as AudibleJson64
            } catch {
              // sometimes the json64 data is incomplete for some reason
            }
          }
          const {
            title = metadata.common.title ?? 'Untitled',
            summary: description = getNativeValue(metadata, 'TXXX:comment') ??
              getNativeValue(metadata, 'COMM:comment') ??
              'No description',
            author = metadata.common.artist ?? 'Unknown author',
            copyright = metadata.common.copyright ?? 'Unknown',
            duration = metadata.format.duration,
            narrated_by: narrators = getNativeValue(
              metadata,
              'TXXX:narrated_by',
            ) ?? '',
            genre: category = getNativeValue(metadata, 'TXXX:book_genre') ??
              getNativeValue(metadata, 'TXXX:genre') ??
              '',
            release_date: date = getNativeValue(metadata, 'TXXX:year'),
          } = audibleMetadata

          const {picture: [picture] = []} = metadata.common

          const id = md5(filepath)

          return {
            id,
            title,
            author,
            pubDate: date ? new Date(date) : new Date(),

            description,
            content: description,
            category: category
              .split(':')
              .map(c => c.trim())
              .filter(Boolean),

            guid: id,

            size: stat.size,
            duration,
            type: `audio/${(
              metadata.format.container ?? 'mpeg'
            ).toLowerCase()}`,
            picture,
            contributor: narrators
              .split(',')
              .map(name => ({name: name.trim()})),

            copyright,
            filepath,
          }
        } catch (error: unknown) {
          if (error instanceof Error) {
            logger.error(`Trouble getting metadata for "${filepath}"`)
            logger.error(error.stack)
          } else {
            logger.error(error)
          }
          return null
        }
      }),
    )

    cache = {}
    for (const item of items) {
      if (item?.id) {
        cache[item.id] = item
      }
    }
  }

  // eslint-disable-next-line complexity
  async function feedMiddleware(req: ex.Request, res: ex.Response) {
    let items = Object.values(await getFilesMetadata()).filter(typedBoolean)
    const filepathParam = req.params[0]
    const filepathRoot = filepathParam
      ? path.join(directory, req.params[0])
      : directory
    if (filepathParam) {
      items = items.filter(item => {
        return item.filepath.startsWith(filepathRoot)
      })
    }

    // filter
    const filteredItems = filterItems({
      items,
      query: {
        filterIn: req.query.filterIn as string | Array<string>,
        filterOut: req.query.filterOut as string | Array<string>,
      },
    })

    // sort
    type SortOption = ISortByObjectSorter<Metadata | undefined>
    const sortOptions: Array<SortOption> = (
      req.query.sort?.toString() ?? 'desc:pubDate'
    )
      .split(',')
      .map(set => {
        const [dir, prop] = set.split(':')
        if (dir !== 'asc' && dir !== 'desc') {
          throw new Error(`Malformatted sort option: ${set}`)
        }
        return {
          [dir]: (i: Record<string, unknown>) => i[prop],
        } as unknown as SortOption
      })
    const sortedItems = sort([...filteredItems]).by(sortOptions)

    let image: PodcastImage | undefined = getDirImage() ?? podcastImage

    if (req.query['image.url']) {
      image = {
        link: req.query['image.link'],
        title: req.query['image.title'],
        description: req.query['image.description'],
        height: req.query['image.height']
          ? Number(req.query['image.height'])
          : undefined,
        width: req.query['image.width']
          ? Number(req.query['image.width'])
          : undefined,
        url: req.query['image.url'],
      } as PodcastImage
    }

    const parsedUrl = (req as typeof req & {_parsedUrl: Url})._parsedUrl

    const xmlObj: XMLJS.ElementCompact = {
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
          title: req.query.title ?? podcastTitle,
          link: getResourceUrl(),
          description: {
            _cdata: parsedUrl.query
              ? // eslint-disable-next-line @typescript-eslint/no-base-to-string
                `<p>${podcastDescription}</p>\n\n<p>query: ${parsedUrl.query}</p>`
              : podcastDescription,
          },
          lastBuildDate: new Date().toUTCString(),
          image,
          generator: getResourceUrl(),
        },
        item: sortedItems.map(item => {
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
            category: category.length ? category : null,
            'content:encoded': {_cdata: description},
            enclosure: {
              _attributes: {
                length: size,
                type,
                url: getResourceUrl(`resource/${id}/audio.mp3`),
              },
            },
            'itunes:title': title,
            'itunes:author': author,
            'itunes:duration': duration,
            'itunes:image': {
              _attributes: {href: getResourceUrl(`resource/${id}/image`)},
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

  async function getDirImage() {
    const dirPodcastImages = await glob.promise(
      path.join(directory, '**/art.png'),
    )

    for (const dirPodcastImage of dirPodcastImages) {
      const imageDir = path.dirname(dirPodcastImage)
    }
  }

  async function imageMiddleware(req: ex.Request, res: ex.Response) {
    const item = await getFileMetadata(req.params.id)
    const picture = item?.picture
    if (!picture) return res.status(404).end()

    const {format, data} = picture
    res.set('content-type', format)
    res.end(data, 'binary')
  }

  async function audioMiddleware(req: ex.Request, res: ex.Response) {
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

    const stream = fs.createReadStream(filepath, options)
    stream.on('open', () => stream.pipe(res))
    stream.on('error', err => res.end(err))
    stream.on('end', () => res.end())
  }

  async function bustCacheMiddleware(req: ex.Request, res: ex.Response) {
    await loadFileMetadataCache()
    res.send('success 🎉')
  }

  return {
    feed: feedMiddleware,
    image: imageMiddleware,
    audio: audioMiddleware,
    bustCache: bustCacheMiddleware,
  }
}

function filterItems<ItemType extends Record<string, unknown>>({
  items,
  query,
}: {
  items: Array<ItemType>
  query: {filterIn: string | Array<string>; filterOut: string | Array<string>}
}) {
  // filter
  let filteredItems = []
  const filterIns = arrayify(query.filterIn)
  const filterOuts = arrayify(query.filterOut)

  if (filterIns.length) {
    for (const filterIn of filterIns) {
      const filterInOptions = filterIn
        .split(',')
        .filter(Boolean)
        .map(set => {
          const [regexString, prop] = set.split(':')
          return {regex: new RegExp(regexString, 'im'), prop}
        })
      for (const item of items) {
        const matches = filterInOptions.every(({regex, prop}) => {
          let value = item[prop]
          value = typeof value === 'string' ? value : JSON.stringify(value)
          return regex.test(value as string)
        })
        if (matches) {
          filteredItems.push(item)
        }
      }
    }
  } else {
    filteredItems = items
  }

  for (const filterOut of filterOuts) {
    const filterOutOptions = filterOut
      .split(',')
      .filter(Boolean)
      .map(set => {
        const [regexString, prop] = set.split(':')
        return {regex: new RegExp(regexString, 'im'), prop}
      })
    for (const item of items) {
      const matches = filterOutOptions.every(({regex, prop}) => {
        let value = item[prop]
        value = typeof value === 'string' ? value : JSON.stringify(value)
        return regex.test(value as string)
      })
      if (matches) {
        filteredItems.splice(filteredItems.indexOf(item), 1)
      }
    }
  }

  return filteredItems
}

function typedBoolean<T>(
  value: T,
): value is Exclude<T, '' | 0 | false | null | undefined> {
  return Boolean(value)
}

function removeEmpty(obj?: Record<string, unknown>) {
  if (!obj) {
    return obj
  }
  const newObj: typeof obj = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value != null) {
      newObj[key] = value
    }
  }
  return newObj
}

export {getPodcastMiddleware}
export type {PodcastMiddlewareOptions}

/*
eslint
  max-lines-per-function: "off",
  no-inner-declarations: "off",
  consistent-return: "off",
*/
