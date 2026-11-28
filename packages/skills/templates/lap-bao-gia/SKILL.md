---
name: lap-bao-gia
description: Tra bảng giá, áp chiết khấu theo khách, soạn báo giá theo mẫu. Dùng khi khách hoặc đại lý hỏi giá.
---
# Lập báo giá

## Khi nào dùng
- Khách hoặc đại lý hỏi giá một hay nhiều sản phẩm.
- Người giao việc nhờ soạn báo giá cho một khách cụ thể.

## Các bước
1. Hỏi lại nếu thiếu: tên khách, sản phẩm, số lượng, thời gian giao.
2. Tra bảng giá trong `references/bang-gia-mau.md` để lấy đơn giá từng sản phẩm.
3. Xác định nhóm khách (khách lẻ, đại lý cấp 1, đại lý cấp 2) và mức chiết khấu tương ứng.
4. Tính thành tiền từng dòng và tổng cộng; làm tròn đến đồng.
5. Điền vào mẫu `assets/bao-gia-mau.xlsx`, ghi rõ ngày báo giá và thời hạn hiệu lực.

## Không làm
- Không tự đặt giá hay chiết khấu ngoài bảng giá; trường hợp đặc biệt thì hỏi người giao việc.
- Không tự gửi báo giá ra ngoài, chỉ soạn nháp cho người giao việc.

## Đầu ra
- Báo giá theo mẫu, kèm một dòng tóm tắt: khách, tổng tiền, chiết khấu đã áp.
