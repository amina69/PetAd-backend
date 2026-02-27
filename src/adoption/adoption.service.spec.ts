

describe('AdoptionService', () => {
  let service: AdoptionService;


  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdoptionService,

      ],
    }).compile();

    service = module.get<AdoptionService>(AdoptionService);
  });


  });
});
