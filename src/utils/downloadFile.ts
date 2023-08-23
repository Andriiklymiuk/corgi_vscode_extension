import * as fs from 'fs';
import * as https from 'https';

export function downloadFile(url: string, dest: string, cb: (error?: Error) => void): void {
  const file = fs.createWriteStream(dest);
  const request = https.get(url, function (response) {
    response.pipe(file);
    file.on('finish', function () {
      file.close(() => cb());
    });
  }).on('error', function (err: Error) {
    fs.unlink(dest, (unlinkErr) => {
      if (unlinkErr) {
        console.error('Error unlinking file:', unlinkErr);
      }
      cb(err);
    });
  });
}
