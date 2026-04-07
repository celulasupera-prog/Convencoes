import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const password = 'adminpassword'
  const salt = await bcrypt.genSalt()
  const password_hash = await bcrypt.hash(password, salt)

  // Create Organization
  const org = await prisma.organization.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      name: 'MTE Monitor Admin',
    },
  })

  // Create User
  await prisma.user.upsert({
    where: { email: 'admin@mte.com' },
    update: {},
    create: {
      email: 'admin@mte.com',
      name: 'Administrador',
      password_hash,
      role: 'ADMIN',
      organizationId: org.id,
    },
  })

  console.log('Seed completed successfully.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
