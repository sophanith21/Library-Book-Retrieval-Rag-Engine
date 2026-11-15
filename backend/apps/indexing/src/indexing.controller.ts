import { Controller, Get } from '@nestjs/common';
import { IndexingService } from './indexing.service';

@Controller()
export class IndexingController {
  constructor(private readonly indexingService: IndexingService) {}

  @Get()
  getHello(): string {
    return this.indexingService.getHello();
  }
}
