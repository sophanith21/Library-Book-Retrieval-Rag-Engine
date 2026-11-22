import { Module } from '@nestjs/common';
import { KnowledgeDbModule } from '@app/knowledge-db';
import { Bm25SearchRepository } from './bm25-search.repository';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [KnowledgeDbModule],
  controllers: [RetrievalController],
  providers: [Bm25SearchRepository, RetrievalService],
})
export class RetrievalModule {}
