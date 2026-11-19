"""Real-browser E2E: 4 phones (mobile viewport) + 1 laptop display, all in the same room."""
import sys, os, re, json, time, subprocess, signal
import cv2, numpy as np
from playwright.sync_api import sync_playwright

PORT = 3177
BASE = f"http://localhost:{PORT}"
OUT = "/home/claude/chkoun/test/shots"
os.makedirs(OUT, exist_ok=True)
errors = []
passed = 0
failed = 0

def check(cond, msg):
    global passed, failed
    if cond: passed += 1
    else:
        failed += 1; print("  FAIL:", msg)

srv = subprocess.Popen(["node", "/home/claude/chkoun/server.js"], env={**os.environ, "PORT": str(PORT), "RATE_LIMIT": "off"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.0)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        def phone(name):
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            pg = ctx.new_page()
            pg.on("pageerror", lambda e, n=name: errors.append(f"{n} pageerror: {e}"))
            pg.on("console", lambda m, n=name: errors.append(f"{n} console.error: {m.text}") if m.type == "error" and "favicon" not in m.text else None)
            return ctx, pg

        names = ["Ahmed", "Sami", "Nour", "Yassine"]
        ctxs, pages = zip(*[phone(n) for n in names])

        # ---- home + create
        h = pages[0]
        h.goto(BASE); h.wait_for_selector(".logo")
        h.wait_for_function("(() => { const i = document.querySelector('.logo img.hero'); return i && i.complete && i.naturalWidth > 0; })()")
        check(True, "home logo picture loads")
        h.screenshot(path=f"{OUT}/01_home.png")
        h.fill("input.inp >> nth=0", "Ahmed")
        # avatar picker: 10 real pictures, all loaded, selectable
        h.wait_for_function("document.querySelectorAll('.av img').length === 10")
        h.wait_for_function("[...document.querySelectorAll('.av img')].every(i => i.complete && i.naturalWidth > 0)")
        check(h.locator(".av img").count() == 10, "avatar picker shows 10 pictures")
        check(h.locator(".av").first.inner_text().strip() == "", "avatar picker has no emoji text left")
        h.locator(".av").nth(2).click()
        check(h.locator(".av.on").count() == 1 and h.locator(".av.on").get_attribute("data-a") == "a3", "tapping an avatar selects it")
        h.screenshot(path=f"{OUT}/01b_avatar_picker.png")
        h.click("text=Ebda partie jdida")
        h.wait_for_selector(".roomcode")
        h.wait_for_selector(".pl .a img")
        check("/avatars/a3.jpg" in h.locator(".pl .a img").first.get_attribute("src"), "lobby shows the chosen avatar picture")
        code = h.inner_text(".roomcode").strip()
        check(re.fullmatch(r"[A-HJ-NP-Z2-9]{6}", code) is not None, f"room code format {code}")

        # ---- QR really scans and points at the join URL
        png = h.locator(".qr canvas").screenshot()
        img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
        img = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        val, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
        print("  QR decodes to:", val)
        check(val.endswith(f"/?r={code}"), "QR code decodes to the join link with the room code")

        # ---- other phones join using the link (scan simulation)
        for pg, n in zip(pages[1:], names[1:]):
            pg.goto(f"{BASE}/?r={code}"); pg.wait_for_selector(".logo")
            check(pg.input_value("input.inp.code") == code, f"{n}: code prefilled from QR link")
            pg.fill("input.inp >> nth=0", n)
            pg.click("text=Edkhol lel partie")
            pg.wait_for_selector(".players")
        h.wait_for_function("document.querySelectorAll('.pl').length===4")
        check(True, "4 players visible in host lobby")
        h.screenshot(path=f"{OUT}/02_lobby_host.png", full_page=True)
        pages[1].screenshot(path=f"{OUT}/03_lobby_guest.png", full_page=True)

        # ---- big screen (laptop)
        sctx = browser.new_context(viewport={"width": 1280, "height": 720})
        scr = sctx.new_page(); scr.on("pageerror", lambda e: errors.append(f"screen pageerror: {e}"))
        scr.goto(f"{BASE}/?screen={code}"); scr.wait_for_selector(".roomcode"); scr.wait_for_function("document.querySelectorAll('.pl').length===4")
        scr.screenshot(path=f"{OUT}/04_screen_lobby.png")

        # ---- host settings: 5 rounds; start
        h.click(".seg button:has-text('5')")
        h.wait_for_function("document.querySelector('.seg button.on').textContent==='5'")
        pages[1].wait_for_function("document.querySelector('.seg button.on').textContent==='5'")
        check(True, "settings synced to guest")
        h.click("text=Ibda el le3ba")
        for pg in pages: pg.wait_for_selector(".qcard")
        check(True, "all phones entered voting")
        h.screenshot(path=f"{OUT}/05_voting.png", full_page=True)
        scr.wait_for_selector(".qcard"); scr.screenshot(path=f"{OUT}/06_screen_voting.png")

        def vote_all(pick_names):
            """pick_names: list of candidate names for each phone in order"""
            for pg, who in zip(pages, pick_names):
                pg.wait_for_selector(".cand")
                cands = pg.locator(".cand .n").all_inner_texts()
                check("Ahmed" not in cands if pg is pages[0] else True, "host cannot vote for self (not offered)")
                pg.locator(f".cand:has(.n:text-is('{who}'))").click()
                pg.click(".confirm .btn")
                if pg is pages[0] and not os.path.exists(f"{OUT}/07_waiting.png.done"):
                    pg.wait_for_selector(".card.wait", timeout=5000); pg.screenshot(path=f"{OUT}/07_waiting.png")
                    check(pg.locator(".cand").count() == 0, "locked vote: no more candidates shown while waiting")

        # round 1: all vote Sami (Sami votes Nour)
        vote_all(["Sami", "Nour", "Sami", "Sami"])
        for pg in pages: pg.wait_for_selector(".verdict", timeout=9000)
        time.sleep(0.8)
        verdict = pages[2].inner_text(".verdict h2"); print("  verdict:", verdict)
        check("Sami" in verdict, "reveal shows Sami as winner")
        counts = pages[2].locator(".rr .cnt").all_inner_texts(); names_r = pages[2].locator(".rr .nm").all_inner_texts()
        print("  results:", list(zip(names_r, counts)))
        check(counts[0] == "3", "Sami has 3 votes")
        pages[2].screenshot(path=f"{OUT}/08_reveal.png", full_page=True)
        scr.wait_for_selector(".verdict"); scr.screenshot(path=f"{OUT}/09_screen_reveal.png")
        # only host has next button
        check(pages[1].locator("text=Round jey").count() == 0 and pages[0].locator("text=Round jey").count() == 1, "only host sees next button")

        # ---- reload a phone mid-game: must resume (session persistence + reconnection)
        pages[3].reload(); pages[3].wait_for_selector(".verdict", timeout=6000)
        check(True, "phone reload resumes same room/screen")

        # ---- offline -> online on phone 2 during next round
        pages[0].click("text=Round jey")
        for pg in pages: pg.wait_for_selector(".cand")
        ctxs[1].set_offline(True); time.sleep(1.0)
        pages[1].locator(".cand >> nth=0").click()  # UI still works offline until confirm
        ctxs[1].set_offline(False)
        pages[1].wait_for_function("document.getElementById('netbar').hidden===true", timeout=15000)
        check(True, "network banner clears after reconnect")
        pages[1].screenshot(path=f"{OUT}/10_after_reconnect.png")
        vote_all.__call__(["Nour", "Nour", "Ahmed", "Nour"])  # round 2: Nour 3 votes
        for pg in pages: pg.wait_for_selector(".verdict", timeout=9000)

        # ---- tie round: continue to round 3 then leaderboard
        pages[0].click("text=Round jey")
        for pg in pages: pg.wait_for_selector(".cand")
        vote_all(["Sami", "Nour", "Yassine", "Ahmed"])  # perfect tie of 4
        for pg in pages: pg.wait_for_selector(".verdict", timeout=9000)
        time.sleep(0.5)
        vt = pages[1].inner_text(".verdict h2"); print("  tie verdict:", vt)
        check("Ta3adol" in vt, "tie displayed")
        pages[1].screenshot(path=f"{OUT}/11_tie.png", full_page=True)
        check(pages[0].locator("text=Classement").count() >= 1, "host button leads to leaderboard after round 3")
        pages[0].click("text=Classement")
        for pg in pages: pg.wait_for_selector(".lrow")
        pages[1].screenshot(path=f"{OUT}/12_leaderboard.png", full_page=True)
        scr.screenshot(path=f"{OUT}/13_screen_leaderboard.png")
        pages[0].click("text=Kamel")
        for pg in pages: pg.wait_for_selector(".cand")
        vote_all(["Nour", "Ahmed", "Ahmed", "Ahmed"])
        for pg in pages: pg.wait_for_selector(".verdict", timeout=9000)
        pages[0].click("text=Round jey")
        for pg in pages: pg.wait_for_selector(".cand")
        # host forces reveal with only 1 vote
        pages[1].locator(".cand >> nth=0").click(); pages[1].click(".confirm .btn")
        time.sleep(0.4)
        pages[0].click("text=Kchef dork")
        for pg in pages: pg.wait_for_selector(".verdict", timeout=9000)
        check(True, "host force-reveal works from UI")
        pages[0].click("text=Chouf el nataij")
        for pg in pages: pg.wait_for_selector(".podium, .lb", timeout=8000)
        time.sleep(1.6)
        pages[2].screenshot(path=f"{OUT}/14_final.png", full_page=True)
        scr.screenshot(path=f"{OUT}/15_screen_final.png")
        titles = pages[2].locator(".lrow .tt").all_inner_texts(); print("  titles:", titles)
        check(len(titles) == 4 and all(titles), "every player has a funny title")
        pages[0].click("text=A3ed el le3ba")
        for pg in pages: pg.wait_for_selector(".roomcode")
        check(True, "rematch returns everyone to lobby")

        # no horizontal overflow on phones
        for pg, n in zip(pages, names):
            w = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check(w <= 1, f"{n}: no horizontal scroll ({w}px)")
        browser.close()
finally:
    srv.send_signal(signal.SIGTERM)

real_errors = [e for e in errors if "Failed to load resource" not in e or "favicon" not in e]
print("JS errors:", real_errors if real_errors else "none")
check(not real_errors, "no JS errors in any browser")
print(f"\nBROWSER E2E: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
