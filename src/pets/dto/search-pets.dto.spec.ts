import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SearchPetsDto } from './search-pets.dto';
import { PetSpecies } from '../../common/enums';

describe('SearchPetsDto Validation', () => {
  it('should validate a correct geo query', async () => {
    const dto = plainToInstance(SearchPetsDto, {
      near: '52.5200,13.4050',
      radius: '25',
      species: PetSpecies.DOG,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.radius).toBe(25);
  });

  it('should accept a negative latitude/longitude in near', async () => {
    const dto = plainToInstance(SearchPetsDto, { near: '-33.8688,151.2093' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject a malformed near value', async () => {
    const dto = plainToInstance(SearchPetsDto, { near: '52.5200' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'near')).toBe(true);
  });

  it('should reject a non-numeric near value', async () => {
    const dto = plainToInstance(SearchPetsDto, { near: 'north,east' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'near')).toBe(true);
  });

  it('should treat an empty radius as absent', async () => {
    const dto = plainToInstance(SearchPetsDto, { radius: '' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.radius).toBeUndefined();
  });

  it('should reject a non-numeric radius', async () => {
    const dto = plainToInstance(SearchPetsDto, { radius: 'far' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'radius')).toBe(true);
  });

  it('should reject a radius below the 0.1 km minimum', async () => {
    const dto = plainToInstance(SearchPetsDto, { radius: '0' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'radius')).toBe(true);
  });
});
