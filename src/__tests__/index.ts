import path from 'path'
import {startServer} from '../'

test('smoke test', async () => {
  const server = await startServer({
    title: 'All the books',
    users: {bob: 'the_builder'},
    description: 'All fixtures',
    directory: path.join(process.cwd(), 'test/fixtures'),
  })
  await server.close()
})
