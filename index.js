if (process.env.NODE_ENV === 'production') {
  require('./dist/example')
} else {
  require('nodemon')({script: 'dev.js', watch: ['./src/**/*.*']})
}
