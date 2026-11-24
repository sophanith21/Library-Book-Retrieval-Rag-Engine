import { Module } from '@nestjs/common';
import { EmbeddingService } from './embeddings.service';

@Module({
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingsModule {}
