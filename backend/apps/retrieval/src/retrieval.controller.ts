import { Controller, Get } from '@nestjs/common';
import { RetrievalService } from './retrieval.service';

@Controller()
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Get()
  getHello(): string {
    return this.retrievalService.getHello();
  }
}
