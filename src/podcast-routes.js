import express from 'express'
import basicAuth from 'express-basic-auth'
import {getPodcastMiddleware} from './podcast-controller'

function getPodcastRoutes({users, ...middlewareOptions} = {}) {
  // eslint-disable-next-line babel/new-cap
  const router = express.Router()

  const {feed, image, audio} = getPodcastMiddleware(middlewareOptions)

  const asyncMiddleware = mid => (req, res, next) =>
    mid(req, res).catch(e => next(e))

  router.get(
    '/feed.xml',
    basicAuth({users, challenge: true}),
    asyncMiddleware(feed),
  )
  router.get('/:id/image', asyncMiddleware(image))
  router.get('/:id/audio.mp3', asyncMiddleware(audio))

  return router
}

export {getPodcastRoutes}

/*
eslint
  max-lines-per-function: "off",
  no-inner-declarations: "off"
*/
