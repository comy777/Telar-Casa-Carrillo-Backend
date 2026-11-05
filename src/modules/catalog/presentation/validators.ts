import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationOptions } from 'class-validator';

/** Objeto plano de texto a texto, p. ej. { color: "Natural" }. */
export function IsStringRecord(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isStringRecord',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          Object.values(value).every((item) => typeof item === 'string'),
        defaultMessage: () => '$property debe ser un objeto cuyos valores sean texto',
      },
    },
    options,
  );
}

/** "true"/"false" de la query string o de un formulario a booleano. */
export const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  });
