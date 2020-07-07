import path from 'path'
import logger from 'loglevel'
import {startServer} from '.'

const isTest = process.env.NODE_ENV === 'test'
const logLevel = process.env.LOG_LEVEL || (isTest ? 'warn' : 'info')

logger.setLevel(logLevel)

startServer({
  title: 'Dodds Family Audiobooks',
  description: 'The audio books of the Dodds Family',
  port: process.env.PORT ?? 8765,
  directory: path.join(__dirname, '..', 'podcast.ignored'),
  users: {bob: 'the_builder'},
})
