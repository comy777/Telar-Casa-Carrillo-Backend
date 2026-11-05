import {
  applyDecorators,
  BadRequestException,
  ParseFilePipe,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { MAX_IMAGE_BYTES } from '../../../shared/application/image-storage';

/**
 * Recibe un archivo `file` en multipart/form-data, en memoria y con límite de
 * tamaño (multer responde 413 si se supera). El tipo real se valida por su
 * contenido en el caso de uso, no por el Content-Type que manda el cliente.
 */
export const AcceptsImage = (bodyType: new () => object) =>
  applyDecorators(
    UseInterceptors(
      FileInterceptor('file', {
        storage: memoryStorage(),
        limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, parts: 12 },
      }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody({ type: bodyType }),
  );

export const UploadedImage = () =>
  UploadedFile(
    new ParseFilePipe({
      fileIsRequired: true,
      exceptionFactory: () => new BadRequestException('Falta el archivo en el campo "file"'),
    }),
  );
