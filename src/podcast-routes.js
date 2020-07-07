import express from 'express'
import basicAuth from 'express-basic-auth'
import {getPodcastMiddleware} from './podcast-controller'

function getPodcastRoutes({title, directory, users} = {}) {
  // eslint-disable-next-line babel/new-cap
  const router = express.Router()

  const {feed, image, audio} = getPodcastMiddleware({title, directory})
  router.use(basicAuth({users, challenge: true}))

  const asyncMiddleware = mid => (req, res, next) =>
    mid(req, res).catch(e => next(e))

  router.get('/feed.xml', asyncMiddleware(feed))
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
