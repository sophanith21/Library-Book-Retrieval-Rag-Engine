import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { QUEUES, SERVICES } from '@app/contracts';
import { ApiGatewayController } from './api-gateway.controller';
import { ApiGatewayService } from './api-gateway.service';
import { IndexingGatewayController } from './indexing.controller';

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
      rmqClient(SERVICES.INDEXING, QUEUES.INDEXING),
    ]),
  ],
  controllers: [
    ApiGatewayController,
    IndexingGatewayController,
  ],
  providers: [ApiGatewayService],
})
export class ApiGatewayModule {}
