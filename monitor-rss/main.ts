import $ from "@david/dax";
import { Command } from "@cliffy/command";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getRss(pid: number): Promise<number | undefined> {
  const result = await $`ps -o "rss=" -p ${pid}`.stdout("piped");
  const output = Number(result.stdout);
  if (isNaN(output)) {
    return;
  }
  return output;
}

export const command = new Command().name("monitor-rss").arguments(
  "<pid:number>",
).option("--interval -i <ms:number>", "interval to poll RSS").action(
  async ({ interval }, pid) => {
    const sleepInterval = interval ?? 1000;
    while (true) {
      const rss = await getRss(pid);
      if (!rss) {
        break;
      }
      console.log(rss);
      await sleep(sleepInterval);
    }
  },
);
