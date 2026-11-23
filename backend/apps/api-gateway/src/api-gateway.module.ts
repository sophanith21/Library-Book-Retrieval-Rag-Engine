import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { QUEUES, SERVICES } from '@app/contracts';
import { ApiGatewayController } from './api-gateway.controller';
import { ApiGatewayService } from './api-gateway.service';
import { AuthGatewayController } from './auth.controller';
import { IndexingGatewayController } from './indexing.controller';
import { SearchGatewayController } from './search.controller';

const rmqClient = (name: string, queue: string) => ({
  name,
  transport: Transport.RMQ as const,
  options: {
    urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
    queue,
    queueOptions: { durable: true },
  },
});

@Module({
  imports: [
    ClientsModule.register([
      rmqClient(SERVICES.AUTH, QUEUES.AUTH),
      rmqClient(SERVICES.INDEXING, QUEUES.INDEXING),
      rmqClient(SERVICES.RETRIEVAL, QUEUES.RETRIEVAL),
    ]),
  ],
  controllers: [
    ApiGatewayController,
    AuthGatewayController,
    IndexingGatewayController,
    SearchGatewayController,
  ],
  providers: [ApiGatewayService],
})
export class ApiGatewayModule {}
