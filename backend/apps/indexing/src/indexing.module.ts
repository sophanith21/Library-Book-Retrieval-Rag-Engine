import { Module } from '@nestjs/common';
import { KnowledgeDbModule } from '@app/knowledge-db';
import { IndexingController } from './indexing.controller';
import { IndexingService } from './indexing.service';
import { InvertedIndexRepository } from './inverted-index.repository';

@Module({
  imports: [KnowledgeDbModule],
  controllers: [IndexingController],
  providers: [InvertedIndexRepository, IndexingService],
})
export class IndexingModule {}
