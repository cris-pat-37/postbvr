import { env } from '../config/env.js';

const OPEN_MINUTES = 11 * 60;
const CLOSE_MINUTES = 23 * 60;

const getIstDate = () => {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000);
};

export const getScheduleStatus = () => {
  if (env.localBypassStoreHours) {
    return {
      isWithinSchedule: true,
      opensAt: '11:00 AM',
      closesAt: '11:00 PM',
      nextMessage: 'Local testing bypass is active',
    };
  }

  const ist = getIstDate();
  const totalMinutes = ist.getHours() * 60 + ist.getMinutes();
  const isWithinSchedule = totalMinutes >= OPEN_MINUTES && totalMinutes < CLOSE_MINUTES;

  return {
    isWithinSchedule,
    opensAt: '11:00 AM',
    closesAt: '11:00 PM',
    nextMessage: ist.getHours() < 11 ? 'Opens today at 11:00 AM' : 'Opens tomorrow at 11:00 AM',
  };
};

export const buildRestaurantStatus = (runtimeState) => {
  const schedule = getScheduleStatus();
  const kitchenPaused = Boolean(runtimeState?.kitchenPaused);
  const maintenanceMode = Boolean(runtimeState?.maintenanceMode);

  return {
    kitchenPaused,
    maintenanceMode,
    updatedAt: runtimeState?.updatedAt || null,
    updatedByRole: runtimeState?.updatedByRole || null,
    ...schedule,
    isAcceptingOrders: schedule.isWithinSchedule && !kitchenPaused && !maintenanceMode,
  };
};

export const assertRestaurantAcceptingOrders = (runtimeState) => {
  const status = buildRestaurantStatus(runtimeState);

  if (status.maintenanceMode) {
    const error = new Error('We are currently under maintenance. Please try again soon.');
    error.statusCode = 503;
    throw error;
  }

  if (!status.isWithinSchedule) {
    const error = new Error(`Orders are accepted only between ${status.opensAt} and ${status.closesAt} IST`);
    error.statusCode = 409;
    throw error;
  }

  if (status.kitchenPaused) {
    const error = new Error('Kitchen is temporarily paused. Please try again later.');
    error.statusCode = 409;
    throw error;
  }

  return status;
};
