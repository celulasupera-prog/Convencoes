import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function test() {
  try {
    const users = await prisma.user.findMany()
    console.log('SUCCESS:', users.length, 'users found')
  } catch (err: any) {
    console.error('FAILURE:', err.message)
    console.error('ERROR OBJECT:', JSON.stringify(err, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

test()
