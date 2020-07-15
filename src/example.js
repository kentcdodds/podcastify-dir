import path from 'path'
import {startServer} from '.'

startServer({
  title: 'Dodds Family Audiobooks',
  description: 'The audio books of the Dodds Family',
  port: process.env.PORT ?? 8765,
  directory: path.join(__dirname, '..', 'podcast.ignored'),
  users: {bob: 'the_builder'},
  modifyXmlJs(xmlJs) {
    xmlJs.rss.channel['itunes:author'] = 'Kent C. Dodds'
    xmlJs.rss.channel['itunes:summary'] = 'Dodds Family Audiobooks'
    return xmlJs
  },
})
