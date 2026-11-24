import { Module } from '@nestjs/common';
import { KnowledgeDbModule } from '@app/knowledge-db';
import { EmbeddingsModule } from '@app/embeddings';
import { Bm25SearchRepository } from './bm25-search.repository';
import { DenseSearchRepository } from './dense-search.repository';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [KnowledgeDbModule, EmbeddingsModule],
  controllers: [RetrievalController],
  providers: [Bm25SearchRepository, DenseSearchRepository, RetrievalService],
})
export class RetrievalModule {}
