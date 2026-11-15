import { Module } from '@nestjs/common';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [],
  controllers: [RetrievalController],
  providers: [RetrievalService],
})
export class RetrievalModule {}
