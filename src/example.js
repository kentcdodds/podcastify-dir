import logger from 'loglevel'
import {startServer} from '.'

const isTest = process.env.NODE_ENV === 'test'
const logLevel = process.env.LOG_LEVEL || (isTest ? 'warn' : 'info')

logger.setLevel(logLevel)

startServer({
  title: 'Dodds Family Audiobooks',
  port: process.env.PORT ?? 8765,
  directory: '/Users/kentcdodds/Library/OpenAudible/mp3',
  users: {bob: 'the_builder'},
})
