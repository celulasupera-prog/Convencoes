import { Test, TestingModule } from '@nestjs/testing';
import { TrackedCnpjsService } from './tracked-cnpjs.service';

describe('TrackedCnpjsService', () => {
  let service: TrackedCnpjsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TrackedCnpjsService],
    }).compile();

    service = module.get<TrackedCnpjsService>(TrackedCnpjsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
