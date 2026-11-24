import { Module } from '@nestjs/common';
import { KnowledgeDbModule } from '@app/knowledge-db';
import { EmbeddingsModule } from '@app/embeddings';
import { DenseIndexRepository } from './dense-index.repository';
import { IndexingController } from './indexing.controller';
import { IndexingService } from './indexing.service';
import { InvertedIndexRepository } from './inverted-index.repository';

@Module({
  imports: [KnowledgeDbModule, EmbeddingsModule],
  controllers: [IndexingController],
  providers: [InvertedIndexRepository, DenseIndexRepository, IndexingService],
})
export class IndexingModule {}
