import * as fs from 'fs';
import * as https from 'https';

export function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, function (response) {
      response.pipe(file);
      file.on('finish', function () {
        file.close(() => resolve());
      });
    }).on('error', function (err: Error) {
      fs.unlink(dest, () => { });
      reject(err);
    });
  });
}
