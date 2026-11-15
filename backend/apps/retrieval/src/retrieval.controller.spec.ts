import { Test, TestingModule } from '@nestjs/testing';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';

describe('RetrievalController', () => {
  let retrievalController: RetrievalController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [RetrievalController],
      providers: [RetrievalService],
    }).compile();

    retrievalController = app.get<RetrievalController>(RetrievalController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(retrievalController.getHello()).toBe('Hello World!');
    });
  });
});
