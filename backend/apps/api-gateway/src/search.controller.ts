import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  PATTERNS,
  SearchQueryDto,
  SearchResponse,
  SERVICES,
} from '@app/contracts';
import { firstValueFrom, timeout } from 'rxjs';

@Controller('search')
export class SearchGatewayController {
  constructor(
    @Inject(SERVICES.RETRIEVAL) private readonly client: ClientProxy,
  ) {}

  /** GET /search?q=white+whale&limit=10&offset=0 (via the edge: /api/search) */
  @Get()
  search(
    @Query('q') q = '',
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
}
