/** 失敗の多くは入力やログインの誤りで、スタックトレースは読み手の邪魔になるので、メッセージだけを出す。 */
export async function runCli(main: () => Promise<void> | void): Promise<void> {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
