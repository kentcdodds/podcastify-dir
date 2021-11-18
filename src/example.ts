import path from 'path'
import loglevel from 'loglevel'
import {startServer} from '.'

loglevel.setLevel('DEBUG')

void startServer({
  title: 'Dodds Family Audiobooks',
  description: 'The audio books of the Dodds Family',
  port: process.env.PORT ?? 8765,
  directory: path.join(process.cwd(), 'test/fixtures'),
  users: {bob: 'the_builder'},
  mountpath: '/',
  modifyXmlJs(xmlJs) {
    xmlJs.rss.channel['itunes:author'] = 'Kent C. Dodds'
    xmlJs.rss.channel['itunes:summary'] = 'Dodds Family Audiobooks'
    return xmlJs
  },
})
