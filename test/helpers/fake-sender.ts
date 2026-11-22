/** AWS SDK のクライアントの send だけを持つ偽物。送ったコマンドを残し、respond の値を返す。 */
export function fakeSender(respond: (command: object) => unknown = () => ({})) {
  const sent: object[] = [];
  const client = {
    async send(command: object): Promise<unknown> {
      sent.push(command);
      return respond(command);
    },
  };
  return { client, sent };
}
