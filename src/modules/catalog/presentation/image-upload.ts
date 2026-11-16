import {
  applyDecorators,
  BadRequestException,
  ParseFilePipe,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
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

/** Máximo de imágenes por envío en las subidas múltiples. */
export const MAX_IMAGES_PER_UPLOAD = 10;

/** Recibe hasta {@link MAX_IMAGES_PER_UPLOAD} archivos en el campo `files`. */
export const AcceptsImages = (bodyType: new () => object) =>
  applyDecorators(
    UseInterceptors(
      FilesInterceptor('files', MAX_IMAGES_PER_UPLOAD, {
        storage: memoryStorage(),
        limits: {
          fileSize: MAX_IMAGE_BYTES,
          files: MAX_IMAGES_PER_UPLOAD,
          fields: 10,
          parts: MAX_IMAGES_PER_UPLOAD + 10,
        },
      }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody({ type: bodyType }),
  );

export const UploadedImages = () =>
  UploadedFiles(
    new ParseFilePipe({
      fileIsRequired: true,
      exceptionFactory: () => new BadRequestException('Faltan los archivos en el campo "files"'),
    }),
  );
