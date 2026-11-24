import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  DenseSearchQueryDto,
  DenseSearchResponse,
  PATTERNS,
  SearchQueryDto,
  SearchResponse,
  SERVICES,
} from '@app/contracts';
import { firstValueFrom, timeout } from 'rxjs';

@ApiTags('search')
@Controller('search')
export class SearchGatewayController {
  constructor(
    @Inject(SERVICES.RETRIEVAL) private readonly client: ClientProxy,
  ) {}

  /** GET /search?q=white+whale&limit=10&offset=0 (via the edge: /api/search) */
  @Get()
  @ApiOperation({ summary: 'Sparse BM25 keyword search' })
  @ApiQuery({ name: 'q', type: String, required: true, example: 'white whale' })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 10 })
  @ApiQuery({ name: 'offset', type: Number, required: false, example: 0 })
  search(
    @Query('q') q: string = '',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<SearchResponse> {
    const dto: SearchQueryDto = {
      query: q,
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
    };
    return firstValueFrom(
      this.client
        .send<SearchResponse>(PATTERNS.RETRIEVAL.SEARCH, dto)
        .pipe(timeout(10_000)),
    );
  }

  /** GET /search/dense?q=quantum+computation&limit=10&offset=0&topKChunks=20 */
  @Get('dense')
  @ApiOperation({ summary: 'Dense semantic vector search (pgvector HNSW)' })
  @ApiQuery({
    name: 'q',
    type: String,
    required: true,
    example: 'how do quantum computers break encryption',
  })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 10 })
  @ApiQuery({ name: 'offset', type: Number, required: false, example: 0 })
  @ApiQuery({ name: 'topKChunks', type: Number, required: false, example: 20 })
  denseSearch(
    @Query('q') q: string = '',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('topKChunks') topKChunks?: string,
  ): Promise<DenseSearchResponse> {
    const dto: DenseSearchQueryDto = {
      query: q,
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
      topKChunks: topKChunks === undefined ? undefined : Number(topKChunks),
    };
    return firstValueFrom(
      this.client
        .send<DenseSearchResponse>(PATTERNS.RETRIEVAL.DENSE_SEARCH, dto)
        .pipe(timeout(15_000)),
    );
  }
}
