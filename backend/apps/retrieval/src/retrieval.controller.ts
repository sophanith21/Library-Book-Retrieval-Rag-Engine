import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  DenseSearchQueryDto,
  DenseSearchResponse,
  PATTERNS,
  SearchQueryDto,
  SearchResponse,
} from '@app/contracts';
import { RetrievalService } from './retrieval.service';

@Controller()
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @MessagePattern(PATTERNS.RETRIEVAL.SEARCH)
  search(@Payload() dto: SearchQueryDto): Promise<SearchResponse> {
    return this.retrievalService.search(dto);
  }

  @MessagePattern(PATTERNS.RETRIEVAL.DENSE_SEARCH)
  denseSearch(
    @Payload() dto: DenseSearchQueryDto,
  ): Promise<DenseSearchResponse> {
    return this.retrievalService.denseSearch(dto);
  }
}
