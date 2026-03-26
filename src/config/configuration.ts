import { config } from 'dotenv';

config();

export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
});
