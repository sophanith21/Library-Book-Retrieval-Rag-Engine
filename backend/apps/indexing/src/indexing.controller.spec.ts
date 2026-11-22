import { Test, TestingModule } from '@nestjs/testing';
import { IndexingController } from './indexing.controller';
import { IndexingService } from './indexing.service';

describe('IndexingController', () => {
  let indexingController: IndexingController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [IndexingController],
      providers: [IndexingService],
    }).compile();

    indexingController = app.get<IndexingController>(IndexingController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(indexingController.getHello()).toBe('Hello World!');
    });
  });
});
