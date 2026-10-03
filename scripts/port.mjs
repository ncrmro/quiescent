import net from "node:net";

/** @param {string} host @param {number} port @returns {Promise<boolean>} */
function available(host, port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}
/** @param {string} host @param {number} preferred @param {boolean} fixed */
export async function allocatePort(host, preferred, fixed = false) {
  let port = preferred;
  while (!(await available(host, port))) {
    if (fixed) throw new Error(`Port ${port} is occupied.`);
    port++;
  }
  return port;
}
