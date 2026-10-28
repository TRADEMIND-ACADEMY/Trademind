from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
import qrcode
root = Path(__file__).resolve().parents[1]
logo = Image.open(root/'products/application/public/assets/trademind-official-logo.jpg').convert('RGB')
canvas = Image.new('RGB',(512,512),(14,10,22))
cover = ImageOps.fit(logo,(430,430),method=Image.Resampling.LANCZOS)
canvas.paste(cover,(41,41))
canvas.save(root/'public/icons/icon-512.png', optimize=True)
canvas.resize((192,192),Image.Resampling.LANCZOS).save(root/'public/icons/icon-192.png', optimize=True)
mask = Image.new('RGB',(512,512),(112,71,184)); cover = ImageOps.fit(logo,(410,410),method=Image.Resampling.LANCZOS); mask.paste(cover,(51,51)); mask.save(root/'public/icons/icon-maskable-512.png', optimize=True)
canvas.save(root/'public/favicon.ico', format='ICO', sizes=[(32,32),(48,48),(64,64)])
methods = {
 'airtel-rdc':'Airtel Money RDC:+243965430389',
 'usdt-erc20':'ethereum:0x4fb5dd52e54545a2e7e36768b33c6c4ec955c286?asset=USDT&network=ERC-20',
 'usdt-bep20':'bsc:0x4fb5dd52e54545a2e7e36768b33c6c4ec955c286?asset=USDT&network=BEP-20',
 'bitcoin':'bitcoin:15Nby76XKWCbEtf5EezR3BEFLKqmZYTj9T'
}
for key, payload in methods.items():
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=4)
    qr.add_data(payload); qr.make(fit=True)
    qr.make_image(fill_color='#17111f', back_color='white').save(root/f'products/public-site/assets/qr/{key}.png')
print('generated PWA and QR assets')
