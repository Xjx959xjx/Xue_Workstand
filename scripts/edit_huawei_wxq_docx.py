#!/usr/bin/env python3
"""Replace the partner script table with the focused Wangzhe Wanxiangqi version."""

from __future__ import annotations

import copy
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}
W = f"{{{W_NS}}}"


def set_cell_lines(cell: etree._Element, lines: list[str]) -> None:
    paragraphs = cell.xpath("./w:p", namespaces=NS)
    if not paragraphs:
        paragraph = etree.SubElement(cell, f"{W}p")
    else:
        paragraph = paragraphs[0]

    paragraph_properties = paragraph.find(f"{W}pPr")
    template_run = paragraph.find(f"{W}r")
    template_rpr = template_run.find(f"{W}rPr") if template_run is not None else None

    for child in list(paragraph):
        if child is not paragraph_properties:
            paragraph.remove(child)

    run = etree.SubElement(paragraph, f"{W}r")
    if template_rpr is not None:
        run.append(copy.deepcopy(template_rpr))

    for index, line in enumerate(lines):
        text = etree.SubElement(run, f"{W}t")
        text.text = line
        if index < len(lines) - 1:
            br = etree.SubElement(run, f"{W}br")
            br.set(f"{W}type", "textWrapping")


def set_row(row: etree._Element, values: list[list[str]]) -> None:
    cells = row.xpath("./w:tc", namespaces=NS)
    for cell, lines in zip(cells, values):
        set_cell_lines(cell, lines)


def allow_row_to_grow(row: etree._Element) -> None:
    """Let long script cells grow and split across pages instead of clipping text."""
    row_pr = row.find(f"{W}trPr")
    if row_pr is None:
        row_pr = etree.Element(f"{W}trPr")
        row.insert(0, row_pr)
    for tag in ("trHeight", "cantSplit"):
        for child in row_pr.findall(f"{W}{tag}"):
            row_pr.remove(child)


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: edit_huawei_wxq_docx.py INPUT.docx OUTPUT.docx")

    source = Path(sys.argv[1]).expanduser().resolve()
    output = Path(sys.argv[2]).expanduser().resolve()
    merge_runs = Path("/Users/xjx/.agents/skills/docx/scripts/merge_runs.py")

    with tempfile.TemporaryDirectory(prefix="huawei-wxq-docx-") as temp:
        work = Path(temp) / "unpacked"
        work.mkdir()
        with zipfile.ZipFile(source) as archive:
            archive.extractall(work)

        subprocess.run(["python3", str(merge_runs), str(work)], check=True, stdout=subprocess.DEVNULL)

        document_path = work / "word" / "document.xml"
        tree = etree.parse(str(document_path))
        rows = tree.xpath("//w:tbl/w:tr", namespaces=NS)
        if len(rows) < 21:
            raise RuntimeError(f"unexpected table row count: {len(rows)}")

        set_row(rows[12], [
            ["1"],
            ["6秒"],
            ["近景 特写"],
            ["三折叠从合拢到完整展开", "切入产品全貌"],
            ["把一块屏幕掰成三块以后", "华为这次终于找到了", "三折叠最正确的打开方式"],
            ["使用官方产品展开素材"],
        ])
        set_row(rows[13], [
            ["2"],
            ["15秒"],
            ["全景 中景"],
            ["华为发布会主视觉", "Mate XT 2与HarmonyOS 7画面", "切入王者万象棋演示"],
            ["9月7日华为发布会上", "HarmonyOS 7和Mate XT 2正式亮相", "王者万象棋也带着适配上台", "毕竟这种游戏屏幕一小", "先糊的不是画质是你的阵容"],
            ["发布会演示素材", "落到游戏大屏画面"],
        ])
        set_row(rows[14], [
            ["3"],
            ["25秒"],
            ["近景 特写"],
            ["展示大屏棋盘", "切入备战界面", "卡牌与站位画面"],
            ["万象棋这东西", "备战时得先抢牌凑联动", "再安排谁扛前排", "谁在后面打输出", "有的英雄还得靠卡牌一层层养起来", "等级最高能冲到999", "前面买牌升级伺候了半天", "就等他接管比赛"],
            ["三折叠棋盘画面", "卡牌联动与站位素材"],
        ])
        set_row(rows[15], [
            ["4"],
            ["19秒"],
            ["特写"],
            ["战斗动画", "大招清屏", "AI插帧效果"],
            ["小屏最先扛不住", "阵容还没看全", "团战已经开了", "大哥一放技能人就被特效盖没了", "到底是在乱杀还是在逛街", "只能等结算再对账", "三折叠展开以后", "棋盘显示面积更大", "备战时牌面和站位一眼扫全", "开打后大哥也不容易看丢", "再配上AI插帧", "满场技能一起开", "动作更连贯", "前半局我养你", "后半局你可别给我逛街啊"],
            ["保留游戏音效", "重点展示大招片段"],
        ])
        set_row(rows[16], [
            ["5"],
            ["8秒"],
            ["特写"],
            ["匹配时切到消息界面", "展示实况窗组局状态", "切回游戏"],
            ["下一局匹配时切出去回消息", "实况窗还显示着组局状态", "排到了再切回来", "不用每十秒进去查岗"],
            ["完整保留切出与切回关系"],
        ])
        set_row(rows[17], [
            ["6"],
            ["12秒"],
            ["近景 特写"],
            ["两台支持设备碰一碰", "展示整包传输", "聊天气泡和产品定格"],
            ["当然", "屏幕大了也有个副作用", "旁边的兄弟看得太起劲", "隔着屏幕就开始指挥", "你这张该买", "那个该换", "别急", "万象棋还支持碰一碰整包分享", "两台支持设备碰一下", "游戏包就能直接传过去", "以前这种场外军师", "只能说你行你上", "现在好了", "真能把他安排上"],
            ["字幕 碰一碰整包分享", "结尾回到产品"],
        ])

        for row in rows[12:18]:
            allow_row_to_grow(row)

        table = rows[11].getparent()
        for index in (20, 19, 18):
            table.remove(rows[index])

        tree.write(str(document_path), xml_declaration=True, encoding="UTF-8", standalone=True)

        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists():
            output.unlink()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(work.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(work).as_posix())

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
