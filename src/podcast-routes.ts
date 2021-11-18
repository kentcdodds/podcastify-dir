import express from 'express'
import type * as ex from 'express'
import basicAuth from 'express-basic-auth'
import rateLimit from 'express-rate-limit'
import type {PodcastMiddlewareOptions} from './podcast-controller'
import {getPodcastMiddleware} from './podcast-controller'

type Middleware = (
  req: ex.Request,
  res: ex.Response,
  next?: ex.NextFunction,
) => Promise<void>

function getPodcastRoutes({
  users,
  ...middlewareOptions
}: {users: Record<string, string>} & PodcastMiddlewareOptions) {
  // eslint-disable-next-line @babel/new-cap
  const router = express.Router()

  const {feed, image, audio, bustCache} =
    getPodcastMiddleware(middlewareOptions)

  const asyncMiddleware: (mid: Middleware) => Middleware =
    mid => (req, res, next) =>
      mid(req, res).catch(e => next?.(e))

  // can only request the feed 10 times in 10 seconds
  // if something's trying to brute-force the username/password, they'll
  // be limited to 1 attempt per second. That should... take a while...
  const feedLimit = rateLimit({
    windowMs: 1000 * 10,
    max: 10,
  })

  // if you have a lot of books, then you'll be hitting these endpoints a lot
  // so we'll let you hit it 1000 times in 10 seconds.
  // if someone's trying to brute-force to find your collection, they'll
  // be limited to 10 attempts per second. They might be able to find some
  // unless we come up with a better unique ID mechanism (one that doesn't use the audiobook's ASIN)...
  const resourceLimit = rateLimit({
    windowMs: 1000 * 10,
    max: 1000,
  })

  router.get(
    '/feed.xml',
    feedLimit,
    basicAuth({users, challenge: true}),
    asyncMiddleware(feed),
  )
  router.get(
    /\/(.*?)\/feed\.xml/,
    feedLimit,
    basicAuth({users, challenge: true}),
    asyncMiddleware(feed),
  )
  router.get('/resource/:id/image', resourceLimit, asyncMiddleware(image))
  router.get('/resource/:id/audio.mp3', resourceLimit, asyncMiddleware(audio))
  router.get(
    '/bust-cache',
    rateLimit({windowMs: 1000, max: 1}),
    asyncMiddleware(bustCache),
  )

  return router
}

export {getPodcastRoutes}

/*
eslint
  max-lines-per-function: "off",
  no-inner-declarations: "off"
*/
