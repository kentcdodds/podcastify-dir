import type * as http from 'http'
import express from 'express'
import type * as ex from 'express'
import logger from 'loglevel'
import {getPodcastRoutes} from './podcast-routes'

function startServer({
  app = express(),
  port = process.env.PORT,
  mountpath = '/audiobook',
  ...routeOptions
}: {
  app?: express.Application
  port?: number | string
  mountpath?: string
} & Parameters<typeof getPodcastRoutes>['0']): Promise<http.Server> {
  app.use(mountpath, getPodcastRoutes(routeOptions))

  app.use(errorMiddleware)

  return new Promise(resolve => {
    const server = app.listen(port, () => {
      // @ts-expect-error server.address() always returns an object for me 🤷‍♂️
      logger.info(`Listening on port ${server.address().port}`)
      const originalClose = server.close.bind(server)
      Object.assign(server, {
        close: () => {
          return new Promise(resolveClose => {
            originalClose(resolveClose)
          })
        },
      })
      setupCloseOnExit(server)
      resolve(server)
    })
  })
}

function errorMiddleware(
  error: Error,
  req: ex.Request,
  res: ex.Response,
  next: ex.NextFunction,
) {
  if (res.headersSent) {
    next(error)
  } else {
    logger.error(error)
    res.status(500)
    res.json({
      message: error.message,
      // we only add a `stack` property in non-production environments
      ...(process.env.NODE_ENV === 'production' ? null : {stack: error.stack}),
    })
  }
}

function setupCloseOnExit(server: http.Server) {
  // thank you stack overflow
  // https://stackoverflow.com/a/14032965/971592
  async function exitHandler(options: {exit?: boolean} = {}) {
    await (server.close() as unknown as Promise<void>)
      .then(() => {
        logger.info('Server successfully closed')
      })
      .catch((e: Error) => {
        logger.warn('Something went wrong closing the server', e.stack)
      })
    // eslint-disable-next-line no-process-exit
    if (options.exit) process.exit()
  }

  // do something when app is closing
  process.on('exit', exitHandler)

  // catches ctrl+c event
  process.on('SIGINT', exitHandler.bind(null, {exit: true}))

  // catches "kill pid" (for example: nodemon restart)
  process.on('SIGUSR1', exitHandler.bind(null, {exit: true}))
  process.on('SIGUSR2', exitHandler.bind(null, {exit: true}))

  // catches uncaught exceptions
  process.on('uncaughtException', exitHandler.bind(null, {exit: true}))
}

export {startServer}

/*
eslint
  max-lines-per-function: "off",
  no-inner-declarations: "off"
*/
