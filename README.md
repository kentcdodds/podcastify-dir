<div align="center">
<h1>@kentcdodds/podcastify-dir</h1>

<p>Take a directory of audio files and syndicate them with an rss feed</p>
</div>

---

<!-- prettier-ignore-start -->
[![Build Status][build-badge]][build]
[![Code Coverage][coverage-badge]][coverage]
[![version][version-badge]][package]
[![downloads][downloads-badge]][npmtrends]
[![MIT License][license-badge]][license]

[![All Contributors](https://img.shields.io/badge/all_contributors-1-orange.svg?style=flat-square)](#contributors-)
[![PRs Welcome][prs-badge]][prs]
[![Code of Conduct][coc-badge]][coc]
<!-- prettier-ignore-end -->

## The problem

You have a directory of audio files that you'd like to turn into a self-hosted
podcast RSS feed.

There are various reasons you might want to do this. My use-case is I have 150
audiobooks that I've purchased and I don't want to use Audible or Libro.fm (for
example) to listen to them so instead I've downloaded the MP3 files. It's too
much to store on my device all at once, and I want to be able to cast them to my
TV/speakers with Chromecast. I also need this to be password protected to avoid
stealing my library.

## This solution

This is a node server which will serve an RSS feed of all the audio files in a
directory of your choosing. It uses express to handle GET requests to
`/audiobook/feed.xml`, `/audiobook/:bookId/image`, and
`audiobook/:bookId/audio.mp3` (the only one you need to ever access directly is
the feed).

To solve my specific problem, I store all my audiobooks on the Synology
DiskStation (NAS) I have and run this server directly on that NAS (scaling is
not an issue because my family are the only ones that use it). From there, I use
a podcast app (the best I've found is PocketCasts) to consume the feed and
access/download all my audiobooks. Most podcast apps support reading the chapter
ID3 tags embedded in the audiobook files so you even get chapter support. It's
pretty seamless!

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Installation](#installation)
- [Usage](#usage)
  - [Project setup](#project-setup)
- [Other exports](#other-exports)
- [Other info](#other-info)
  - [query string](#query-string)
  - [cache](#cache)
  - [Editing book metadata](#editing-book-metadata)
- [Other Solutions](#other-solutions)
- [About `@kentcdodds/` scoped and `kcd-` prefixed packages](#about-kentcdodds-scoped-and-kcd--prefixed-packages)
- [Issues](#issues)
  - [🐛 Bugs](#-bugs)
  - [💡 Feature Requests](#-feature-requests)
- [Contributors ✨](#contributors-)
- [LICENSE](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Installation

This module is distributed via [npm][npm] which is bundled with [node][node] and
should be installed as one of your project's `dependencies`:

```
npm install --save @kentcdodds/podcastify-dir
```

## Usage

```javascript
const path = require('path')
const {startServer} = require('@kentcdodds/podcastify-dir')

startServer({
  // the title will appear in the podcast app identifying this feed
  title: 'Podcast Title',

  // the description will normally appear on the feed's screen in the podcast app
  description: 'Some great audiobooks',

  // This image will show up in the podcast app for this feed
  image: {
    url: 'https://www.example.com/some-image.png',
    link: 'https://www.example.com',
    height: 500,
    width: 500,

    // I'm not 100% certain what these are for...
    title: 'Some title for the image',
    description: 'Some description for the image',
  },

  // the port you want to bind to (if not specified, it chooses a random port)
  port: process.env.PORT,

  // the directory of audio files
  directory: path.join(__dirname, '..', 'audiobooks'),

  // the username and password that will allow you to access the feed
  users: {bob: 'the_builder'},

  // a little inversion of control here to allow you to modify the JS object
  // that's converted to XML. We're using the `xml-js` npm module so you'll
  // want to make sure your modifications will work with that package's
  // `convert.js2xml` method
  modifyXmlJs(xmlJs) {
    xmlJs.rss.channel['itunes:author'] = 'Your name'
    xmlJs.rss.channel['itunes:summary'] = 'Some other stuff'
    return xmlJs
  },
})
```

`startServer` returns a promise with the started server in case that's useful.
It also ensures that the server is shut down properly if the process exits.

The server also supports rate limiting to help avoid people brute-forcing the
username/password.

### Project setup

In my project, I only need a few things to get this running: `package.json`,
`index.js`, and `forever.config.json`

**`package.json`**:

This lists the dependencies and the scripts for the project.

```json
{
  "private": true,
  "name": "doddsfam-audiobooks",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "stop": "FOREVER_ROOT=./.forever forever stopall",
    "start": "FOREVER_ROOT=./.forever forever start ./forever.config.json"
  },
  "license": "UNLICENSED",
  "dependencies": {
    "@kentcdodds/podcastify-dir": "^1.4.2",
    "forever": "^3.0.0"
  }
}
```

**`forever.config.json`**:

[`forever`](https://npm.im/forever) is a module that will ensure that if the
server stops for any reason, it is automatically restarted. That way you don't
have to log into your server to restart it if it crashed. Here's how I configure
it:

```json
{
  "append": true,
  "script": "index.js",
  "sourceDir": ".",
  "logFile": "./forever.log",
  "outFile": "./out.log",
  "errFile": "./error.log"
}
```

**`index.js`**:

```javascript
const {startServer} = require('@kentcdodds/podcastify-dir')

startServer({
  title: 'Dodds Family Audiobooks',
  description: 'The audiobooks of the Dodds family',
  image: {
    url: 'https://www.dropbox.com/s/some-id/some-filename.jpg?raw=1',
    title: 'Dodds Family Audiobooks',
    link: 'https://kentcdodds.com',
    height: 500,
    width: 500,
  },
  port: 8879,
  directory: '/volume1/audiobooks/files',
  users: {bob: 'the_builder'},
  modifyXmlJs(xmlJs) {
    xmlJs.rss.channel['itunes:author'] = 'Kent C. Dodds'
    xmlJs.rss.channel['itunes:summary'] = 'Dodds Family Audiobooks'
    return xmlJs
  },
})
```

Because my NAS is accessible via the world-wide-web, I can use this URL in my
podcast app:

```
http://bob:the_builder@example.com:8879/audiobook/feed.xml
```

That's:

```
http://[username]:[password]@[domain_or_global_static_ip_address]:[port]/audiobook/feed.xml
```

I paste that into
[PocketCasts's submit page](https://www.pocketcasts.com/submit) (specifying
"private" so it's not indexed) to get a pocketcast URL for the podcast and then
load that up in my pocketcasts account. I've had some success with other apps,
but I've had some trouble with all of them. I recommend experimenting a bit.

## Other exports

`getPodcastMiddleware` and `getPodcastRoutes` are also exported if you'd like to
use those more directly. I don't plan to document those, but feel free to
explore the source code if you need something more advanced.

## Other info

### query string

The `/audiobook/feed.xml` endpoint allows you to filter and sort the audiobooks
via the query string. You can also specify a custom image. This allows you to
set up custom feeds for different categories of books. Here's a full example
(put on multiple lines to simplify reading it):

```
http://bob:the_builder@example.com:8879/audiobook/feed.xml
?filterIn=fantasy:category
&filterOut=poppins:title,joe:author
&sort=desc:pubDate,asc:duration
&title=Fantasy%20books
&image.url=https%3A%2F%2Fwww.dropbox.com%2Fs%2Fsome-id%2Fsome-name.png%3Fraw%3D1
&image.title=epic%20fantasy
&image.link=https%3A%2F%2Fkentcdodds.com
&image.height=500
&image.width=740
&image.description=epic%20fantasy
```

So you have `title`, `filterIn`, `filterOut`, `sort`, and `image.*` options.

The fitler query params are a list of comma-separated filter sets which is a
pair of `[regex]:[property]`. The `sort` is `[direction]:[property]`.

Alternatively, you could create individual feeds by starting multiple servers on
different ports and putting the audio files in different directories.

### cache

Because reading the audiobook MP3 files for metadata can take some time (added
300ms to the request when testing on my MacBook with just a few books), we cache
the metadata in memory. This is a pretty significant perf savings. However, if
you add a new book, or change metadata about a book, you'll want to delete the
cache, so there's also a `/audiobook/bust-cache` endpoint you can hit with a GET
request and it'll reset the cache.

### Editing book metadata

I use [Kid3](https://kid3.kde.org/) for editing book metadata. It works pretty
well. If you're audiobooks come from a reputable source (most of my books come
from Audible which I download using [OpenAudible](https://openaudible.org/)),
all the metadata should be set properly already. If you need to edit things
manually, here are the values you need to have set:

- `title` - book title
- `comment` - book summary
- `asin` - book ID
- `artist` - book author
- `duration` - the time duration of the audiobook
- `narrated_by` - the person (or people) who narrated the audiobook (optional)
- `book_genre` or `genre` - A colon-separated list of applicable categories:
  `Kids 8-10:Adventure:Fantasy`
- `year` - The release date of the audiobook: `2020-01-23`
- `APIC` - The Cover art (Kid3 allows you to drag-and-drop an image).

## Other Solutions

I'm not aware of any, if you are please [make a pull request][prs] and add it
here!

## About `@kentcdodds/` scoped and `kcd-` prefixed packages

If a package I maintain is scoped to my username (`@kentcdodds`) or prefixed
with `kcd-`, that means I built and maintain it for myself. You're more than
welcome to use it, but I'm not likely to put much work into making it work for
other people's use cases (I'm not heartless, I just don't have the time). If you
have a grander vision for the project, please feel free to bring it up in the
comments and perhaps we can collaborate on that vision and make it more
general-purpose (and remove the scope/prefix), but it's possible I'll recommend
you just fork the project and publish your own version.

## Issues

_Looking to contribute? Look for the [Good First Issue][good-first-issue]
label._

### 🐛 Bugs

Please file an issue for bugs, missing documentation, or unexpected behavior.

[**See Bugs**][bugs]

### 💡 Feature Requests

Please file an issue to suggest new features. Vote on feature requests by adding
a 👍. This helps maintainers prioritize what to work on.

[**See Feature Requests**][requests]

## Contributors ✨

Thanks goes to these people ([emoji key][emojis]):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="https://kentcdodds.com"><img src="https://avatars.githubusercontent.com/u/1500684?v=3" width="100px;" alt="Kent C. Dodds"/><br /><sub><b>Kent C. Dodds</b></sub></a><br /><a href="https://github.com/kentcdodds/podcastify-dir/commits?author=kentcdodds" title="Code">💻</a> <a href="https://github.com/kentcdodds/podcastify-dir/commits?author=kentcdodds" title="Documentation">📖</a> <a href="#infra-kentcdodds" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="https://github.com/kentcdodds/podcastify-dir/commits?author=kentcdodds" title="Tests">⚠️</a></td>
  </tr>
</table>

<!-- markdownlint-enable -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors][all-contributors] specification.
Contributions of any kind welcome!

## LICENSE

MIT

<!-- prettier-ignore-start -->
[npm]: https://www.npmjs.com
[node]: https://nodejs.org
[build-badge]: https://img.shields.io/travis/com/kentcdodds/podcastify-dir.svg?style=flat-square
[build]: https://travis-ci.com/kentcdodds/podcastify-dir
[coverage-badge]: https://img.shields.io/codecov/c/github/kentcdodds/podcastify-dir.svg?style=flat-square
[coverage]: https://codecov.io/github/kentcdodds/podcastify-dir
[version-badge]: https://img.shields.io/npm/v/@kentcdodds/podcastify-dir.svg?style=flat-square
[package]: https://www.npmjs.com/package/@kentcdodds/podcastify-dir
[downloads-badge]: https://img.shields.io/npm/dm/@kentcdodds/podcastify-dir.svg?style=flat-square
[npmtrends]: http://www.npmtrends.com/@kentcdodds/podcastify-dir
[license-badge]: https://img.shields.io/npm/l/@kentcdodds/podcastify-dir.svg?style=flat-square
[license]: https://github.com/kentcdodds/podcastify-dir/blob/master/LICENSE
[prs-badge]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square
[prs]: http://makeapullrequest.com
[coc-badge]: https://img.shields.io/badge/code%20of-conduct-ff69b4.svg?style=flat-square
[coc]: https://github.com/kentcdodds/podcastify-dir/blob/master/other/CODE_OF_CONDUCT.md
[emojis]: https://github.com/all-contributors/all-contributors#emoji-key
[all-contributors]: https://github.com/all-contributors/all-contributors
[bugs]: https://github.com/kentcdodds/podcastify-dir/issues?utf8=%E2%9C%93&q=is%3Aissue+is%3Aopen+sort%3Acreated-desc+label%3Abug
[requests]: https://github.com/kentcdodds/podcastify-dir/issues?utf8=%E2%9C%93&q=is%3Aissue+is%3Aopen+sort%3Areactions-%2B1-desc+label%3Aenhancement
[good-first-issue]: https://github.com/kentcdodds/podcastify-dir/issues?utf8=%E2%9C%93&q=is%3Aissue+is%3Aopen+sort%3Areactions-%2B1-desc+label%3Aenhancement+label%3A%22good+first+issue%22
<!-- prettier-ignore-end -->
