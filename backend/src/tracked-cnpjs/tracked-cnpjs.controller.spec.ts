import { Test, TestingModule } from '@nestjs/testing';
import { TrackedCnpjsController } from './tracked-cnpjs.controller';

describe('TrackedCnpjsController', () => {
  let controller: TrackedCnpjsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrackedCnpjsController],
    }).compile();

    controller = module.get<TrackedCnpjsController>(TrackedCnpjsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
