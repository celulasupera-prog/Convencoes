import { Module } from '@nestjs/common';
import { TrackedCnpjsController } from './tracked-cnpjs.controller';
import { TrackedCnpjsService } from './tracked-cnpjs.service';

@Module({
  controllers: [TrackedCnpjsController],
  providers: [TrackedCnpjsService]
})
export class TrackedCnpjsModule {}
