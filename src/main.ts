import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './modules/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Это нужно для зашиты и жеской проверки запроса
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // удаляет поля из запроса, если их нет в дто
      forbidNonWhitelisted: true, // если поля не коректные то возвращает 400
      transform: true, // жесткая типизация 
    }),
  );
  await app.listen(process.env.PORT ?? 2000);
}

bootstrap();
