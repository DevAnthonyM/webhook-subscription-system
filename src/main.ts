import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

  // Security - Add security headers
  app.use(helmet());

  // CORS (if needed for frontend)
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: true, // Throw error on unknown properties
      transform: true, // Auto-transform payloads to DTO types
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`Application running on: http://localhost:${port}`);
  logger.log(`Webhook endpoint: http://localhost:${port}/webhooks/payment`);
  logger.log(`Health check: http://localhost:${port}/webhooks/health`);
}

bootstrap().catch((err) => {
  // Optionally log the error
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
