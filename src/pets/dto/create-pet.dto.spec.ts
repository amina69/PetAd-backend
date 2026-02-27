import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePetDto } from './create-pet.dto';
import { PetSpecies, PetGender, PetSize } from '../../common/enums';

describe('CreatePetDto Validation', () => {
  it('should validate a correct DTO', async () => {
    const dto = plainToInstance(CreatePetDto, {
      name: 'Buddy',
      species: PetSpecies.DOG,
      breed: 'Golden Retriever',
      age: 3,
      gender: PetGender.MALE,
      size: PetSize.LARGE,
      color: 'Golden',
      description: 'Friendly dog',
      images: ['https://example.com/buddy.jpg'],
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail if required fields are missing', async () => {
    const dto = plainToInstance(CreatePetDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
    expect(errors.some((e) => e.property === 'species')).toBe(true);
  });

  it('should fail for invalid enum values', async () => {
    const dto = plainToInstance(CreatePetDto, {
      name: 'Buddy',
      species: 'INVALID',
      gender: 'UNKNOWN',
      size: 'HUGE',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'species')).toBe(true);
    expect(errors.some((e) => e.property === 'gender')).toBe(true);
    expect(errors.some((e) => e.property === 'size')).toBe(true);
  });

  it('should allow optional fields to be omitted', async () => {
    const dto = plainToInstance(CreatePetDto, {
      name: 'Kitty',
      species: PetSpecies.CAT,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail if images is not an array', async () => {
    const dto = plainToInstance(CreatePetDto, {
      name: 'Buddy',
      species: PetSpecies.DOG,
      images: 'not-an-array',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'images')).toBe(true);
  });
});
