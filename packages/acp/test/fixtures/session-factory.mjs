export const sessionFactory = () => {
  throw new Error("Factory must not run during the initialization handshake.");
};
